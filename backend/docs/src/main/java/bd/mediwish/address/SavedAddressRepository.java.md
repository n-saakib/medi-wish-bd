# SavedAddressRepository.java

Source: [SavedAddressRepository.java](../../../../../../../src/main/java/bd/mediwish/address/SavedAddressRepository.java)

Reads only one owner in PostgreSQL created_at/id order. Native INSERT ON CONFLICT (user_id,id) DO NOTHING protects create identity. Change-log insertion, retention pruning and half-open window counts run in the service transaction; the log stores only owner and instant. flush orders default removal before replacement under the partial unique index.
