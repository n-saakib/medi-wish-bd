# AddressBookController.java

Source: [AddressBookController.java](../../../../../../../src/main/java/bd/mediwish/address/AddressBookController.java)

GET/POST collection and PUT/DELETE owner item routes use the current Bearer principal. Exact JSON keys and types, lowercase canonical UUIDs, non-negative integral edit versions and one-to-eighteen-digit delete versions are parsed before entering the service. Create returns 201 for insertion and 200 for replay. Domain errors use shared bounded advice.
