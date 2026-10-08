import { Module } from '@nestjs/common';
import { ChargesController } from './charges.controller.js';
import { SimController } from './sim.controller.js';
import { SimService } from './sim.service.js';

@Module({ controllers: [ChargesController, SimController], providers: [SimService] })
export class AppModule {}
