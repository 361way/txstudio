package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// OK 成功响应
func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// Created 创建成功响应
func Created(c *gin.Context, data any) {
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": data})
}

// Fail 错误响应
func Fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

// BadRequest 400
func BadRequest(c *gin.Context, msg string) {
	Fail(c, http.StatusBadRequest, msg)
}

// Unauthorized 401
func Unauthorized(c *gin.Context, msg string) {
	Fail(c, http.StatusUnauthorized, msg)
}

// NotFound 404
func NotFound(c *gin.Context, msg string) {
	Fail(c, http.StatusNotFound, msg)
}

// InternalError 500
func InternalError(c *gin.Context, msg string) {
	Fail(c, http.StatusInternalServerError, msg)
}
