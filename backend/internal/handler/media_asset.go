package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"cnb.cool/txcloud/txstudio/backend/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxMediaAssetCacheLimit = 200

type mediaAssetLookupReq struct {
	SubAppID  uint64 `json:"sub_app_id"`
	MD5       string `json:"md5"`
	MediaType string `json:"media_type"`
}

type mediaAssetUpsertReq struct {
	SubAppID    uint64 `json:"sub_app_id"`
	MD5         string `json:"md5"`
	MediaType   string `json:"media_type"`
	FileID      string `json:"file_id"`
	MediaURL    string `json:"media_url"`
	MimeType    string `json:"mime_type"`
	FileSize    int64  `json:"file_size"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	StorageMode string `json:"storage_mode"`
	ExpiresAt   int64  `json:"expires_at"`
	Status      string `json:"status"`
	VerifiedAt  int64  `json:"verified_at"`
}

type mediaAssetInvalidateReq struct {
	ID        uint   `json:"id"`
	SubAppID  uint64 `json:"sub_app_id"`
	MD5       string `json:"md5"`
	MediaType string `json:"media_type"`
	FileID    string `json:"file_id"`
}

type MediaAssetHandler struct {
	DB     *gorm.DB
	Crypto *service.CryptoService
}

func NewMediaAssetHandler(db *gorm.DB, crypto *service.CryptoService) *MediaAssetHandler {
	return &MediaAssetHandler{DB: db, Crypto: crypto}
}

// resolveSubAppID 优先使用调用方传入值；为空时从服务端凭证解析，保证前端不需要接触 SubAppId 也能写缓存。
func (h *MediaAssetHandler) resolveSubAppID(requested uint64) (uint64, error) {
	if requested > 0 {
		return requested, nil
	}
	data, err := loadTencentCredentialData(h.DB, h.Crypto)
	if err != nil {
		return 0, err
	}
	subAppID, err := parsePositiveUint64(data["sub_app_id"])
	if err != nil {
		return 0, &publicError{message: "腾讯云凭证中的 SubAppId 无效"}
	}
	return subAppID, nil
}

func normalizeMediaAssetType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "video" {
		return "video"
	}
	return "image"
}

func normalizeMediaAssetStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "invalid", "deleted", "failed":
		return "invalid"
	default:
		return "ready"
	}
}

func optionalTimeFromMillis(value int64) *time.Time {
	if value <= 0 {
		return nil
	}
	t := time.UnixMilli(value)
	return &t
}

func (h *MediaAssetHandler) findReady(req mediaAssetLookupReq) (*model.MediaAsset, error) {
	var asset model.MediaAsset
	err := h.DB.Where("sub_app_id = ? AND md5 = ? AND media_type = ? AND status = ?", req.SubAppID, strings.ToLower(req.MD5), normalizeMediaAssetType(req.MediaType), "ready").
		Where("(storage_mode <> ? OR expires_at IS NULL OR expires_at > ?)", "Temporary", time.Now()).
		Order("verified_at DESC, last_used_at DESC, updated_at DESC").
		First(&asset).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func (h *MediaAssetHandler) Lookup(c *gin.Context) {
	requested, _ := strconv.ParseUint(c.Query("sub_app_id"), 10, 64)
	md5 := strings.ToLower(strings.TrimSpace(c.Query("md5")))
	mediaType := normalizeMediaAssetType(c.Query("media_type"))
	subAppID, err := h.resolveSubAppID(requested)
	if err != nil {
		BadRequest(c, "缺少有效的 sub_app_id 且无法从凭证解析")
		return
	}
	if len(md5) != 32 {
		BadRequest(c, "缺少有效的 md5")
		return
	}
	asset, err := h.findReady(mediaAssetLookupReq{SubAppID: subAppID, MD5: md5, MediaType: mediaType})
	if err != nil {
		InternalError(c, "查询媒体素材缓存失败")
		return
	}
	OK(c, asset)
}

func (h *MediaAssetHandler) Upsert(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
	var req mediaAssetUpsertReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "媒体素材缓存参数无效")
		return
	}
	subAppID, err := h.resolveSubAppID(req.SubAppID)
	if err != nil {
		BadRequest(c, "缺少有效的 sub_app_id 且无法从凭证解析")
		return
	}
	if len(strings.TrimSpace(req.MD5)) != 32 || strings.TrimSpace(req.FileID) == "" || !strings.HasPrefix(strings.TrimSpace(req.MediaURL), "https://") {
		BadRequest(c, "媒体素材缓存缺少有效凭证或地址")
		return
	}
	now := time.Now()
	asset := model.MediaAsset{
		SubAppID:    subAppID,
		MD5:         strings.ToLower(strings.TrimSpace(req.MD5)),
		MediaType:   normalizeMediaAssetType(req.MediaType),
		FileID:      strings.TrimSpace(req.FileID),
		MediaURL:    strings.TrimSpace(req.MediaURL),
		MimeType:    strings.TrimSpace(req.MimeType),
		FileSize:    req.FileSize,
		Width:       req.Width,
		Height:      req.Height,
		StorageMode: req.StorageMode,
		ExpiresAt:   optionalTimeFromMillis(req.ExpiresAt),
		Status:      normalizeMediaAssetStatus(req.Status),
		VerifiedAt:  optionalTimeFromMillis(req.VerifiedAt),
		LastUsedAt:  now,
		UseCount:    1,
	}
	if asset.StorageMode == "" {
		asset.StorageMode = "Permanent"
	}
	if asset.VerifiedAt == nil {
		asset.VerifiedAt = &now
	}
	if asset.StorageMode == "Temporary" && asset.ExpiresAt == nil {
		expiresAt := now.Add(7 * 24 * time.Hour)
		asset.ExpiresAt = &expiresAt
	}
	err = h.DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "sub_app_id"}, {Name: "md5"}, {Name: "media_type"}},
		DoUpdates: clause.Assignments(map[string]any{
			"file_id":      asset.FileID,
			"media_url":    asset.MediaURL,
			"mime_type":    asset.MimeType,
			"file_size":    asset.FileSize,
			"width":        asset.Width,
			"height":       asset.Height,
			"storage_mode": asset.StorageMode,
			"expires_at":   asset.ExpiresAt,
			"status":       asset.Status,
			"verified_at":  asset.VerifiedAt,
			"last_used_at": asset.LastUsedAt,
			"use_count":    gorm.Expr("use_count + 1"),
			"updated_at":   now,
		}),
	}).Create(&asset).Error
	if err != nil {
		InternalError(c, "保存媒体素材缓存失败")
		return
	}
	OK(c, asset)
}

func (h *MediaAssetHandler) MarkVerified(c *gin.Context) {
	asset, ok := h.resolveMutable(c, mediaAssetInvalidateReq{})
	if !ok {
		return
	}
	now := time.Now()
	updates := map[string]any{"verified_at": now, "last_used_at": now, "status": "ready", "updated_at": now}
	if err := h.DB.Model(asset).Updates(updates).Error; err != nil {
		InternalError(c, "更新媒体素材验证状态失败")
		return
	}
	OK(c, asset)
}

func (h *MediaAssetHandler) Invalidate(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	var req mediaAssetInvalidateReq
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			BadRequest(c, "请求参数无效")
			return
		}
	}
	asset, ok := h.resolveMutable(c, req)
	if !ok {
		return
	}
	now := time.Now()
	updates := map[string]any{"status": "invalid", "last_used_at": now, "updated_at": now}
	if err := h.DB.Model(asset).Updates(updates).Error; err != nil {
		InternalError(c, "标记媒体素材失效失败")
		return
	}
	OK(c, asset)
}

func (h *MediaAssetHandler) resolveMutable(c *gin.Context, req mediaAssetInvalidateReq) (*model.MediaAsset, bool) {
	assetID := req.ID
	if assetID == 0 {
		id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
		assetID = uint(id)
	}
	if assetID > 0 {
		var asset model.MediaAsset
		if err := h.DB.First(&asset, assetID).Error; err != nil {
			NotFound(c, "媒体素材缓存不存在")
			return nil, false
		}
		return &asset, true
	}
	if subAppID, err := h.resolveSubAppID(req.SubAppID); err == nil && strings.TrimSpace(req.MD5) != "" {
		var asset model.MediaAsset
		err := h.DB.Where("sub_app_id = ? AND md5 = ? AND media_type = ?", subAppID, strings.ToLower(req.MD5), normalizeMediaAssetType(req.MediaType)).
			Order("updated_at DESC").First(&asset).Error
		if err == nil {
			return &asset, true
		}
		NotFound(c, "媒体素材缓存不存在")
		return nil, false
	}
	BadRequest(c, "缺少媒体素材缓存 ID")
	return nil, false
}
