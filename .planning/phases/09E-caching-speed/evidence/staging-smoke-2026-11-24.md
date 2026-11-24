# Staging smoke 2026-11-24 (local run)

Base: loopback (local stack). Steps read only. Times in ms; data ready is the app's own `clinicos.data_ready` mark (a load: from navigation start; a click: from the click).

| step | result | data ready | LCP | CLS | FCP | TTFB | data routes (Server-Timing) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Today | ok | 550 | 552 | 0 | 264 | 127 | /api/session-status db 157 ms (calls=3 depth=3), app 182 ms |
| Today to one consult (link) | skipped (no such link on the page (no data of that kind)) |  |  |  |  |  |  |
| Schedule day | ok | 444 | 132 | 0 | 132 | 56 | /api/session-status db 150 ms (calls=3 depth=3), app 182 ms |
| Schedule week | ok | 495 | 184 | 0 | 184 | 63 | /api/session-status db 150 ms (calls=3 depth=3), app 173 ms |
| Patients | ok | 357 | 156 | 0 | 156 | 58 | /api/session-status db 131 ms (calls=3 depth=3), app 147 ms |
| Patients to one patient (link) | ok | 78 | 156 | 0 | 156 | 58 |  |
| Medicine search (GET) | ok | 37 |  |  |  |  | /api/prescriptions/medicines db 12 ms (calls=1 depth=1), app 23 ms |
| Diagnosis search (GET) | ok | 51 |  |  |  |  | /api/terminology/diagnoses db 28 ms (calls=2 depth=2), app 42 ms |
