# StorageConfiguration.java

Servlet-only local adapter configuration. Validates provider, absolute root, namespace syntax and profile isolation after singleton initialization; test profiles require test- namespaces and other profiles refuse them. Hosted/no-profile local storage is refused. Provisioning a hosted adapter remains deferred.
