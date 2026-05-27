import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  /** Validate the single admin against env credentials and issue a JWT. */
  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const login = this.config.getOrThrow<string>('ADMIN_LOGIN');
    const password = this.config.getOrThrow<string>('ADMIN_PASSWORD');

    if (dto.login !== login || dto.password !== password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.jwt.signAsync({
      sub: 'admin',
      role: 'admin',
    });
    return { accessToken };
  }
}
