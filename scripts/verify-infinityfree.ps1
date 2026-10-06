$ErrorActionPreference = "Stop"
$settings = @{}
Get-Content -LiteralPath ".env.deploy.local" | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $separator = $line.IndexOf("=")
  if ($separator -lt 1) { return }
  $settings[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
}
$credential = New-Object System.Net.NetworkCredential($settings.INFINITYFREE_FTP_USER, $settings.INFINITYFREE_FTP_PASSWORD)
$root = "ftp://$($settings.INFINITYFREE_FTP_HOST):$($settings.INFINITYFREE_FTP_PORT)$($settings.INFINITYFREE_FTP_PATH.TrimEnd('/'))"

function Get-RemoteText([string]$name) {
  $request = [System.Net.FtpWebRequest]::Create("$root/$name")
  $request.Method = [System.Net.WebRequestMethods+Ftp]::DownloadFile
  $request.Credentials = $credential
  $request.UsePassive = $true
  $request.KeepAlive = $false
  $response = $request.GetResponse()
  try {
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    try { return $reader.ReadToEnd() } finally { $reader.Close() }
  } finally { $response.Close() }
}

function Test-RemoteFile([string]$name) {
  $request = [System.Net.FtpWebRequest]::Create("$root/$name")
  $request.Method = [System.Net.WebRequestMethods+Ftp]::GetFileSize
  $request.Credentials = $credential
  $request.UsePassive = $true
  $request.KeepAlive = $false
  try {
    $response = $request.GetResponse()
    $response.Close()
    return $true
  } catch {
    if ($_.Exception.Response) { $_.Exception.Response.Close() }
    return $false
  }
}

$index = Get-RemoteText "index.html"
$localIndex = Get-Content -LiteralPath "dist/index.html" -Raw
$expectedJs = [regex]::Match($localIndex, 'src="\./assets/([^"]+\.js)"').Groups[1].Value
$expectedCss = [regex]::Match($localIndex, 'href="\./assets/([^"]+\.css)"').Groups[1].Value
[PSCustomObject]@{
  ExpectedJavaScript = $expectedJs
  ExpectedCss = $expectedCss
  IndexUsesExpectedJs = [bool]($expectedJs -and $index.Contains($expectedJs))
  IndexUsesExpectedCss = [bool]($expectedCss -and $index.Contains($expectedCss))
  JavaScriptAvailable = Test-RemoteFile "assets/$expectedJs"
  CssAvailable = Test-RemoteFile "assets/$expectedCss"
}
