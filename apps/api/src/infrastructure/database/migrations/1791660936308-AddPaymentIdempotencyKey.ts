import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentIdempotencyKey1791660936308 implements MigrationInterface {
  name = 'AddPaymentIdempotencyKey1791660936308';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" ADD "idempotencyKey" character varying(255)`);
    await queryRunner.query(`ALTER TABLE "payments" ADD "requestFingerprint" character(64)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3a58646ecfe0e002a543f46efc" ON "payments"  ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_3a58646ecfe0e002a543f46efc"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "requestFingerprint"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "idempotencyKey"`);
  }
}
