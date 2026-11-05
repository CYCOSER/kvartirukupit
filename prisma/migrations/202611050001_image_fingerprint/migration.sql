CREATE TABLE "ImageFingerprint" (
    "file" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "ImageFingerprint_pkey" PRIMARY KEY ("file")
);
