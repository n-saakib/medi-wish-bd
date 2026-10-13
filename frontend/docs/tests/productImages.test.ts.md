# tests/productImages.test.ts

Tests strict public metadata/list projection, accepted source paths, JPEG/PNG precheck boundaries, authenticated multipart upload fields and deletion response contract. Unknown or unsafe server metadata never reaches the UI or optimizer.


Regression cases accept NBSP, BOM and em-space boundaries in individual/list projections while refusing unnormalized ASCII spaces and controls.
