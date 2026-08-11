package frontend

import _ "embed"

// dist 目录内嵌前端静态文件。
// 构建前需将前端产物复制到本目录下的 dist/：
//   cp ../../dist/index.html frontend/dist/index.html
// 编译后前端将内嵌进二进制，无需单独部署静态文件。
//
//go:embed dist/index.html
var IndexHTML []byte

// 如果未来前端拆分出多个静态资源（JS/CSS/图片），可改为：
// //go:embed all:dist
// var DistFS embed.FS
// 并在 app.go 中用 http.FileServer(http.FS(subFS)) 托管整个目录。
