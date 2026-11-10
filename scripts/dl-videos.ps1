$ProgressPreference='SilentlyContinue'; $list = @'
W2-10s|https://cdn.example.com/artifacts/example-1.mp4
P1-10s|https://cdn.example.com/artifacts/example-2.mp4
B1-10s|https://cdn.example.com/artifacts/example-3.mp4
H1-10s|https://cdn.example.com/artifacts/example-4.mp4
W4-10s|https://cdn.example.com/artifacts/example-5.mp4
'@ -split "`n"; foreach ($line in $list) { $p = $line.Trim().Split('|'); if ($p.Length -eq 2) { $out = 'raw\lovart\video-' + $p[0] + '.mp4'; Invoke-WebRequest -UseBasicParsing -Proxy http://127.0.0.1:7897 -Uri $p[1] -OutFile $out; Write-Output ($p[0] + ' ' + [math]::Round((Get-Item $out).Length/1MB,2) + ' MB') } }