# PasswordResetController.java

Source: [PasswordResetController.java](../../../../../../../src/main/java/bd/mediwish/auth/PasswordResetController.java)

Public POST reset request and confirm adapters enforce exact JSON keys and string types. Email is bounded before normalization and checked with the shared accepted format; codes contain six ASCII digits; new passwords use the existing A5 rule without trimming. Valid requests return empty 202 answers and successful confirms empty 204 answers; no session or cookie is issued.
