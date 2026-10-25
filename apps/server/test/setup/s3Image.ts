// The S3-compatible image for TP-10.3 (A-287): versitygw, pinned by digest. CI pulls it through
// A-284's mirror.gcr.io prefix; a bump changes the tag and the digest in one pull request.
export const S3_TEST_IMAGE =
  "versity/versitygw:v1.8.0@sha256:30292fc2eeacc67a36993b01f7a7a5e3361a19cced0e80c1d71cfa2a4b0a2499";
