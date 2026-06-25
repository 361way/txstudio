package service

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWTService JWT 签发与校验
type JWTService struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

// NewJWTService 创建 JWT 服务
func NewJWTService(secret string, accessTTL, refreshTTL time.Duration) *JWTService {
	return &JWTService{
		secret:     []byte(secret),
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
	}
}

// Claims 自定义 JWT 声明
type Claims struct {
	UserID       uint   `json:"uid"`
	TenantID     uint   `json:"tid"`
	Email        string `json:"email"`
	Role         string `json:"role"`
	IsSuperAdmin bool   `json:"sa"`
	jwt.RegisteredClaims
}

// GenerateAccessToken 签发 access token（短有效期）
func (s *JWTService) GenerateAccessToken(userID, tenantID uint, email, role string, isSuperAdmin bool) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:       userID,
		TenantID:     tenantID,
		Email:        email,
		Role:         role,
		IsSuperAdmin: isSuperAdmin,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(s.accessTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			Subject:   "access",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secret)
}

// GenerateRefreshToken 签发 refresh token（长有效期）
func (s *JWTService) GenerateRefreshToken(userID, tenantID uint, email, role string, isSuperAdmin bool) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:       userID,
		TenantID:     tenantID,
		Email:        email,
		Role:         role,
		IsSuperAdmin: isSuperAdmin,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(s.refreshTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			Subject:   "refresh",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secret)
}

// ParseToken 解析并校验 token
func (s *JWTService) ParseToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
