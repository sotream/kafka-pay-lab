import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutbox1791465766835 implements MigrationInterface {
  name = 'AddOutbox1791465766835';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "outbox_events" ("id" BIGSERIAL NOT NULL, "topic" character varying NOT NULL, "key" character varying NOT NULL, "payload" jsonb NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "publishedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6689a16c00d09b8089f6237f1d2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9e1316bd6e766431092cd9ce40" ON "outbox_events"  ("publishedAt", "id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_9e1316bd6e766431092cd9ce40"`);
    await queryRunner.query(`DROP TABLE "outbox_events"`);
  }
}
