# 09E-14a patient record rows, 300 ms per call, PERF_LATENCY_DEBUG=1 (tool output: the lane run `playwright test --project=perf-latency -g "(in-app|full)\.(R|D)\.patient:"`, after the single-statement `view_patient_record`)

| full.D.patient | B-3 | 15 / 15 | 4 / 4 | 700 / 709 | 1500 | within target | n/a | 0 | 09E-06 | GET /rest/v1/consent_records x2; GET /rest/v1/memberships x2; GET /rest/v1/patients x2; GET /rest/v1/visits x2; GET /rest/v1/consultation_diagnoses x1; GET /rest/v
| full.R.patient | B-3 | 13 / 13 | 4 / 4 | 567 / 629 | 1500 | within target | n/a | 0 | 09E-06 | GET /rest/v1/memberships x2; GET /rest/v1/consent_records x2; GET /rest/v1/patients x1; POST /rest/v1/rpc/view_patient_record x1; GET /rest/v1/visits x1; GET /rest
| full.R.patients | B-3 | 4 / 4 | 3 / 3 | 528 / 564 | 1500 | within target | n/a | 0 | 09E-06 | GET /rest/v1/memberships x1; GET /rest/v1/patients x1; HEAD /rest/v1/in_app_notifications x1; GET /rest/v1/in_app_notifications x1 |
| in-app.D.patient | B-1 | 11 / 11 | 3 / 3 | 448 / 718 | 1000 | within target | 410 | 1 | 09E-06 | GET /rest/v1/consent_records x2; GET /rest/v1/visits x2; GET /rest/v1/patients x1; POST /rest/v1/rpc/view_patient_record x1; GET /rest/v1/queue_tokens x1; GET /r
| in-app.R.patient | B-1 | 10 / 10 | 2 / 2 | 427 / 442 | 1000 | within target | 389 | 1 | 09E-06 | GET /rest/v1/consent_records x2; GET /rest/v1/visits x1; GET /rest/v1/patients x1; POST /rest/v1/rpc/view_patient_record x1; GET /rest/v1/memberships x1; GET /re
| in-app.R.patients | B-1 | 1 / 1 | 1 / 1 | 381 / 403 | 1000 | within target | 34 | 1 | 09E-06 | GET /rest/v1/patients x1 |
| type.R.patient-register | B-5 | 1 / 1 | 1 / 1 | 519 / 522 | 700 | within target | n/a | 0 | measured, not changed | POST /rest/v1/rpc/search_patients x1 |
| type.R.patient-today | B-5 | 1 / 1 | 1 / 1 | 519 / 523 | 700 | within target | n/a | 0 | measured, not changed | POST /rest/v1/rpc/search_patients x1 |
| full.D.patient | B-3 | 14 / 14 | 5 / 5 | 598 / 843 | 1500 | within target | n/a | 0 | 09E-06 | GET /rest/v1/memberships x2; GET /rest/v1/consent_records x2; GET /rest/v1/visits x2; GET /rest/v1/patients x1; POST /rest/v1/rpc/view_patient_record x1; GET /rest
| full.R.patient | B-3 | 14 / 14 | 3 / 3 | 696 / 697 | 1500 | within target | n/a | 0 | 09E-06 | GET /rest/v1/consent_records x2; GET /rest/v1/memberships x2; GET /rest/v1/patients x2; GET /rest/v1/visits x1; GET /rest/v1/queue_tokens x1; GET /rest/v1/consulta
| full.R.patients | B-3 | 4 / 4 | 3 / 3 | 528 / 564 | 1500 | within target | n/a | 0 | 09E-06 | GET /rest/v1/memberships x1; GET /rest/v1/patients x1; HEAD /rest/v1/in_app_notifications x1; GET /rest/v1/in_app_notifications x1 |
| in-app.D.patient | B-1 | 11 / 11 | 3 / 3 | 422 / 429 | 1000 | within target | 386 | 1 | 09E-06 | GET /rest/v1/consent_records x2; GET /rest/v1/visits x2; GET /rest/v1/patients x1; GET /rest/v1/invoices x1; GET /rest/v1/consultation_diagnoses x1; GET /rest/v1
| in-app.R.patient | B-1 | 10 / 10 | 2 / 2 | 646 / 646 | 1000 | within target | 19 | 1 | 09E-06 | GET /rest/v1/consent_records x2; GET /rest/v1/patients x1; GET /rest/v1/visits x1; GET /rest/v1/queue_tokens x1; GET /rest/v1/consultation_diagnoses x1; GET /rest
| in-app.R.patients | B-1 | 1 / 1 | 1 / 1 | 381 / 403 | 1000 | within target | 34 | 1 | 09E-06 | GET /rest/v1/patients x1 |
| type.R.patient-register | B-5 | 1 / 1 | 1 / 1 | 519 / 522 | 700 | within target | n/a | 0 | measured, not changed | POST /rest/v1/rpc/search_patients x1 |
| type.R.patient-today | B-5 | 1 / 1 | 1 / 1 | 519 / 523 | 700 | within target | n/a | 0 | measured, not changed | POST /rest/v1/rpc/search_patients x1 |

## full.R.patient sample 1 (over its depth ceiling; every counted call, ms from the step start)
    server GET /rest/v1/memberships 37-349
    server GET /rest/v1/consent_records 41-352
    server GET /rest/v1/consent_records 41-353
    server POST /rest/v1/rpc/view_patient_record 41-361
    server GET /rest/v1/visits 41-363
    server GET /rest/v1/patients 42-362
    server GET /rest/v1/consultation_diagnoses 366-701
    server GET /rest/v1/queue_tokens 366-705
    server GET /rest/v1/memberships 366-706
    server GET /rest/v1/prescriptions 367-704
    server GET /rest/v1/invoices 367-708
    server HEAD /rest/v1/in_app_notifications 772-1084
    server GET /rest/v1/in_app_notifications 1113-1422

## full.D.patient sample 1 (over its depth ceiling; every counted call, ms from the step start)
    server GET /rest/v1/memberships 32-363
    server GET /rest/v1/consent_records 35-361
    server GET /rest/v1/consent_records 35-363
    server GET /rest/v1/visits 35-370
    server POST /rest/v1/rpc/view_patient_record 35-372
    server GET /rest/v1/patients 36-372
    server GET /rest/v1/consultation_diagnoses 371-687
    server GET /rest/v1/queue_tokens 371-688
    server GET /rest/v1/memberships 371-690
    server GET /rest/v1/prescriptions 372-684
    server GET /rest/v1/invoices 372-693
    server HEAD /rest/v1/in_app_notifications 816-1127
    server GET /rest/v1/in_app_notifications 1159-1468
    server GET /rest/v1/visits 1569-1880
