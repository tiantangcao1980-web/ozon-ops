
param([string]$Sku, [int]$Count)
$ErrorActionPreference = "Continue"
$dir = Join-Path $PSScriptRoot "..\assets\video\$Sku"
$ff = if ($env:FFMPEG_PATH) { $env:FFMPEG_PATH } else { 'ffmpeg' }
for ($i = 1; $i -le $Count; $i++) {
  $inp = Join-Path $dir ("shot-$i.mp4")
  $cap = Join-Path $dir ("cap-$i.png")
  $out = Join-Path $dir ("cap-shot-$i.mp4")
  & $ff -y -i $inp -i $cap -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v];[v][1:v]overlay=0:0" -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 128k -shortest $out 2>&1 | Out-Null
  Write-Output "capped $i"
}
$end = Join-Path $dir "end.mp4"
& $ff -y -loop 1 -i (Join-Path $dir "endcard.jpg") -f lavfi -i "anullsrc=r=44100:cl=stereo" -t 3.5 -vf "scale=1080:1920,setsar=1" -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 128k -shortest $end 2>&1 | Out-Null
$lines = @()
for ($i = 1; $i -le $Count; $i++) { $lines += ("file '" + (Join-Path $dir ("cap-shot-$i.mp4")) + "'") }
$lines += ("file '" + (Join-Path $dir "end.mp4") + "'")
Set-Content -Path (Join-Path $dir "list.txt") -Value $lines -Encoding ASCII
& $ff -y -f concat -safe 0 -i (Join-Path $dir "list.txt") -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 128k -movflags +faststart (Join-Path $dir "DEMO BRAND-$Sku-UGC.mp4") 2>&1 | Out-Null
& (Join-Path (Split-Path $ff) "ffprobe.exe") -v error -show_entries format=duration -of default=noprint_wrappers=1 (Join-Path $dir "DEMO BRAND-$Sku-UGC.mp4")
