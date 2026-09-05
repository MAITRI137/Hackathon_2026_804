CREATE TABLE "user_session" (
  "sid" VARCHAR NOT NULL,
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "user_session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX "user_session_expire_idx" ON "user_session" ("expire");
