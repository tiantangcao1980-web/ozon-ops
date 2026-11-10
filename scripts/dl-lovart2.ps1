$ProgressPreference='SilentlyContinue'; $list = @'
B1-detail|https://cdn.example.com/artifacts/example-1.jpeg
H1-main|https://cdn.example.com/artifacts/example-2.jpeg
H1-scene|https://cdn.example.com/artifacts/example-3.jpeg
H1-detail|https://cdn.example.com/artifacts/example-4.jpeg
W4-main|https://cdn.example.com/artifacts/example-5.jpeg
W4-scene|https://cdn.example.com/artifacts/example-6.jpeg
W4-detail|https://cdn.example.com/artifacts/example-7.jpeg
'@ -split "`n"; foreach ($line in $list) { $p = $line.Trim().Split('|'); if ($p.Length -eq 2) { $out = 'raw\lovart\' + $p[0] + '.jpg'; Invoke-WebRequest -UseBasicParsing -Proxy http://127.0.0.1:7897 -Uri $p[1] -OutFile $out; Write-Output ($p[0] + ' ' + (Get-Item $out).Length) } }