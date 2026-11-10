$ProgressPreference='SilentlyContinue'; $list = @'
W2-cover|https://cdn.example.com/artifacts/example-1.png
P1-cover|https://cdn.example.com/artifacts/example-2.png
B1-cover|https://cdn.example.com/artifacts/example-3.png
H1-cover|https://cdn.example.com/artifacts/example-4.png
W4-cover|https://cdn.example.com/artifacts/example-5.png
'@ -split "`n"; foreach ($line in $list) { $p = $line.Trim().Split('|'); if ($p.Length -eq 2) { $out = 'raw\lovart\' + $p[0] + '.png'; Invoke-WebRequest -UseBasicParsing -Proxy http://127.0.0.1:7897 -Uri $p[1] -OutFile $out; Write-Output ($p[0] + ' ' + (Get-Item $out).Length) } }