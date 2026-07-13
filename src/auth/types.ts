export type AuthMode = 'signIn' | 'signUp';

export type AuthUser = {
  id: string;
  phone: string;
  name: string;
};

export type SignInInput = {
  phone: string;
  password: string;
};

export type SignUpInput = {
  name: string;
  phone: string;
  password: string;
};

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';

export type FieldErrors = Partial<
  Record<'name' | 'phone' | 'password' | 'confirmPassword', string>
>;

export type AuthRoute = 'auth' | 'contactSupport';
