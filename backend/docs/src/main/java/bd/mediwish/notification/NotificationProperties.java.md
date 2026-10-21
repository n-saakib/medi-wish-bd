# `NotificationProperties.java`

Binds `app.notification.security.adapter` and `timeout`. Missing values default to `disabled` and five seconds. Only `disabled` and `capture` adapters are accepted; timeout must be at least one second. The constructor rejects invalid configuration before application startup.
