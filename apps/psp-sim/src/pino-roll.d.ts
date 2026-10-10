// pino-roll ships no types. Only the part this app uses is declared.
declare module 'pino-roll' {
  interface RollOptions {
    file: string;
    extension?: string;
    frequency?: 'daily' | 'hourly';
    size?: string;
    limit?: { count: number };
    mkdir?: boolean;
  }

  export interface RollingStream {
    write(chunk: string): boolean;
    end(): void;
    once(event: 'close', listener: () => void): unknown;
  }

  export default function pinoRoll(options: RollOptions): Promise<RollingStream>;
}
