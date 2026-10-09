import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutboxTraceparent1791571009124 implements MigrationInterface {
  name = 'AddOutboxTraceparent1791571009124';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "outbox_events" ADD "traceparent" character varying(55)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "outbox_events" DROP COLUMN "traceparent"`);
  }
}
