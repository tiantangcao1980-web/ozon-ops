$ProgressPreference='SilentlyContinue'; New-Item -ItemType Directory -Force -Path raw\lovart | Out-Null; $list = @'
W2-main|https://cdn.example.com/artifacts/example-1.jpeg
W2-scene|https://cdn.example.com/artifacts/example-2.jpeg
W2-detail|https://cdn.example.com/artifacts/example-3.jpeg
P1-main|https://cdn.example.com/artifacts/example-4.jpeg
P1-scene|https://cdn.example.com/artifacts/example-5.jpeg
P1-detail|https://cdn.example.com/artifacts/example-6.jpeg
B1-main|https://cdn.example.com/artifacts/example-7.jpeg
B1-scene|https://cdn.example.com/artifacts/example-8.jpeg
'@ -split "`n"; foreach ($line in $list) { $p = $line.Trim().Split('|'); if ($p.Length -eq 2) { $out = 'raw\lovart\' + $p[0] + '.jpg'; Invoke-WebRequest -UseBasicParsing -Proxy http://127.0.0.1:7897 -Uri $p[1] -OutFile $out; Write-Output ($p[0] + ' ' + (Get-Item $out).Length) } }