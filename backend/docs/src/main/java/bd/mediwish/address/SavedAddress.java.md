# SavedAddress.java

Source: [SavedAddress.java](../../../../../../../src/main/java/bd/mediwish/address/SavedAddress.java)

Owner-scoped composite identity (user_id, id), bounded address fields, explicit edit version and microsecond creation/update instants. Editing fields and default promotion are separate operations; the service bumps each changed row exactly once. Never merge a newly assigned id.
