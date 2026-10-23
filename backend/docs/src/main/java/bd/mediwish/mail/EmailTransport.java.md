# EmailTransport.java

Source: [EmailTransport.java](../../../../../../../src/main/java/bd/mediwish/mail/EmailTransport.java)

## Provider-neutral immediate delivery boundary

send receives one transient EmailMessage. Local/test memory and directory adapters and the disabled adapter implement this seam; deployment may add SES without changing callers. Failures expose no provider message or secret cause.
