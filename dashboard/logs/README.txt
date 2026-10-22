Invoice dashboard logs (one file per day, UTC dates)

app-YYYY-MM-DD.log
  Everything the dashboard does: startup, each page request (method, address, result,
  time taken, caller IP), invoice posts, blocked posts with the reason, status checks,
  retries and errors.

nrs-YYYY-MM-DD.log
  One JSON line per call to the NRS / Cryptware API: environment, endpoint, HTTP status,
  time taken, the invoice data sent and the response received. The API key is never written.
  Use this when NRS support asks what was submitted.

Files older than LOG_RETENTION_DAYS (default 90, set in .env.dashboard) are deleted
automatically. LOG_DIR in .env.dashboard moves the logs to another folder.

These files contain customer and invoice data. Do not share them outside PE Energy.
