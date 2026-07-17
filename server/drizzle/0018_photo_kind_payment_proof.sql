-- 0007 was recorded as applied, but photo_kind never gained payment_proof
-- in production (presign with kind=payment_proof then 500s).
ALTER TYPE "public"."photo_kind" ADD VALUE IF NOT EXISTS 'payment_proof';
