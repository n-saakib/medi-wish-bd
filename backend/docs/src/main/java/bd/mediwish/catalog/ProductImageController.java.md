# ProductImageController.java

Servlet-only staff image routes map strict requests onto ProductImageService. Upload authorizes before reading bytes and consumes multipart only; fresh creation is 201 and identical retry is 200. Listing and reorder return ImageList, alt edits return ImageView, and successful removal is 204. Security resolves current staff role and MFA before MVC parses the body.
