# ProductImageQueriesIT.java

Measures real authenticated HTTP R1 list and R2 upload statement counts against isolated PostgreSQL and local object storage using Hibernate statistics. Lists with one and eight images must have the same bounded count, including authentication; the image collection itself requires exactly one query. First and eighth uploads must remain bounded without growth with attached image count. Synthetic PNG fixtures avoid personal data. Prints actual counts for T7 evidence; no latency SLA is introduced.
