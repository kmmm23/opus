# Simple Local Static Web Server for Complaint Board
$port = 8080
$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$port/"
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " [익명 민원 게시판] 로컬 웹 서버가 시작되었습니다!" -ForegroundColor Cyan
    Write-Host " 웹 브라우저에서 아래 주소로 접속하세요:" -ForegroundColor Yellow
    Write-Host " --> $prefix" -ForegroundColor White
    Write-Host " 서버를 종료하려면 이 창에서 Ctrl + C를 누르세요." -ForegroundColor DarkGray
    Write-Host "==========================================================" -ForegroundColor Green

    # Try opening the default browser
    Start-Process $prefix

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $localPath = $request.Url.LocalPath
        if ($localPath -eq "/" -or [string]::IsNullOrEmpty($localPath)) {
            $localPath = "/index.html"
        }

        $filePath = Join-Path $PSScriptRoot ($localPath.TrimStart('/'))

        if (Test-Path $filePath -PathType Leaf) {
            $extension = [System.IO.Path]::GetExtension($filePath).ToLower()
            switch ($extension) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".css"  { $response.ContentType = "text/css; charset=utf-8" }
                ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
                ".json" { $response.ContentType = "application/json; charset=utf-8" }
                ".png"  { $response.ContentType = "image/png" }
                ".ico"  { $response.ContentType = "image/x-icon" }
                default { $response.ContentType = "application/octet-stream" }
            }

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $notFoundBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($notFoundBytes, 0, $notFoundBytes.Length)
        }

        $response.Close()
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}

