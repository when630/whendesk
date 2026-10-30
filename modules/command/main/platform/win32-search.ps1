# main/platform/win32-search.ps1 — Windows Search 질의 서버(FILE-01, D-09·D-21).
# PowerShell 프로세스 시작이 ~400ms라 질의마다 띄울 수 없다. win32.mjs가 한 번 띄워 두고 stdin으로 질의를 보낸다 —
# 실측(2026-09-21) 질의 자체는 ADODB로 8~75ms.
#
# 프로토콜 — 줄 하나가 질의 하나:  "<id>\t<limit>\t<base64(utf8 질의)>"
#            답도 줄 하나 JSON:      {"id":"3","items":[{"n":"이름","p":"C:\\경로","d":false}],"error":null}
#            시작 직후 한 줄:        {"ready":true} 또는 {"ready":false,"error":"..."}
# 질의를 base64로 받는 이유: 리다이렉트된 stdin의 인코딩을 믿지 않는다(한국어 콘솔은 cp949).
# 경로는 System.ItemUrl에서 뽑는다 — System.ItemPathDisplay는 "C:\사용자\…"처럼 **현지화된 표시용 경로**라 실제 경로가 아니다.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$conn = $null
try {
  $conn = New-Object -ComObject ADODB.Connection
  $conn.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
  Write-Output '{"ready":true}'
} catch {
  Write-Output (ConvertTo-Json @{ ready = $false; error = $_.Exception.Message } -Compress)
  exit 1
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split("`t", 3)
  if ($parts.Count -lt 3) { continue }
  $id = $parts[0]
  $limit = [int]$parts[1]
  $q = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[2]))
  # LIKE 패턴에서 뜻을 갖는 글자만 걷어낸다. _는 파일명에 흔해 그대로 둔다(한 글자 와일드카드 — 결과가 조금 넓어질 뿐이다)
  $safe = $q.Replace("'", "''").Replace('%', '').Replace('[', '')
  $sql = "SELECT TOP $limit System.ItemNameDisplay, System.ItemUrl, System.ItemType FROM SYSTEMINDEX " +
         "WHERE System.ItemUrl LIKE 'file:%' AND System.ItemNameDisplay LIKE '%$safe%' ORDER BY System.DateModified DESC"
  $items = New-Object System.Collections.ArrayList
  try {
    $rs = $conn.Execute($sql)
    while (-not $rs.EOF) {
      $url = [string]$rs.Fields.Item('System.ItemUrl').Value
      $p = ($url -replace '^file:', '') -replace '/', '\'
      [void]$items.Add(@{
        n = [string]$rs.Fields.Item('System.ItemNameDisplay').Value
        p = $p
        d = ([string]$rs.Fields.Item('System.ItemType').Value -eq 'Directory')
      })
      $rs.MoveNext()
    }
    $rs.Close()
    Write-Output (ConvertTo-Json @{ id = $id; items = @($items); error = $null } -Compress -Depth 3)
  } catch {
    Write-Output (ConvertTo-Json @{ id = $id; items = @(); error = $_.Exception.Message } -Compress)
  }
}
