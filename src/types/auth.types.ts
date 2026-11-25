import { UserRole } from '../models/user.model.js';

export interface LoginInput {
  email: string;
  password: string;
}

export interface GoogleLoginInput {
  idToken: string;
}

export interface GoogleTokenPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

export interface IGoogleTokenVerifier {
  verifyIdToken(idToken: string, audience: string): Promise<GoogleTokenPayload>;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  mustChangePassword?: boolean;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

export interface JWTPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
