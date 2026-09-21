# build-album.ps1
# 扫描 media/ 里的图片 / 视频，自动生成 assets/js/local-media.js
# 用法：双击「更新相册.bat」，或右键本文件 -> 使用 PowerShell 运行。
# 每次往 media/ 里加了新的照片 / 视频，重跑一次即可，不用手动改代码。

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$mediaDir = Join-Path $root 'media'
$outFile = Join-Path $root 'assets\js\local-media.js'
$maxBytes = 90MB

# 想改「上传者」或「相册名」，改下面两行即可
$owner = '西南 F4'
$album = '本地影像'

$exts = @('.jpg','.jpeg','.png','.gif','.webp','.avif','.heic','.bmp','.mp4','.mov','.webm','.m4v')

$all = Get-ChildItem -LiteralPath $mediaDir -File |
  Where-Object { $exts -contains $_.Extension.ToLower() }

$files = $all |
  Where-Object { $_.Length -le $maxBytes } |
  Sort-Object LastWriteTime -Descending

$epoch = [datetime]::SpecifyKind([datetime]'1970-01-01', [DateTimeKind]::Utc)

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('/* 由 scripts/build-album.ps1 自动生成，请勿手动修改。 */')
$lines.Add('window.LOCAL_MEDIA = [')
foreach ($f in $files) {
  $name = $f.Name.Replace('\', '\\').Replace("'", "\'")
  $ts = [int64](([datetime]$f.LastWriteTimeUtc - $epoch).TotalMilliseconds)
  $lines.Add("  { name: '$name', url: 'media/$name', owner: '$owner', album: '$album', timestamp: $ts },")
}
$lines.Add('];')

[System.IO.File]::WriteAllText($outFile, ($lines -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding($false)))

$skipped = ($all | Where-Object { $_.Length -gt $maxBytes }).Count
Write-Host ""
Write-Host "完成：已写入 $outFile" -ForegroundColor Green
Write-Host "共收录 $($files.Count) 个文件（跳过 $skipped 个超过 90MB 的大文件）。" -ForegroundColor Green
