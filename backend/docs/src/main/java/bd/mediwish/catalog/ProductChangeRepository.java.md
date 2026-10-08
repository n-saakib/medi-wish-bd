# `ProductChangeRepository.java`

Reads the latest 20 audit events with an actor-username projection. The projection avoids materializing User role collections for each history actor.
