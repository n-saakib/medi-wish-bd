# `NotificationProperties.java`

Binds `app.notification.security.adapter` and `timeout`. Missing values default to `disabled` and five seconds. Only `disabled` and `capture` adapters are accepted; timeout must be between one and five seconds, so a hung notifier can't hold the replacement response past the frontend's ten-second request limit. The constructor rejects invalid configuration before application startup.
