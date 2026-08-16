'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';

export default function SignIn() {
    const [isLoading, setIsLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [emailLoading, setEmailLoading] = useState(false);
    const [magicSent, setMagicSent] = useState(false);

    const handleGoogleSignIn = async () => {
        setIsLoading(true);
        try {
            await signIn('google', { callbackUrl: '/' });
        } catch (error) {
            console.error('Sign in error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEmailSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim()) return;
        setEmailLoading(true);
        setMagicSent(false);
        try {
            // Magic-link: NextAuth sends a verification email; then shows the
            // built-in "check your email" interstitial. Same sign-in gate runs.
            await signIn('email', { email, redirect: false, callbackUrl: '/' });
            setMagicSent(true);
        } catch (error) {
            console.error('Email sign-in error:', error);
            setMagicSent(false);
        } finally {
            setEmailLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md bg-[#1a1a1a] rounded-2xl border border-gray-800 p-8 shadow-2xl">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent mb-2">
                        Welcome to Astryon
                    </h1>
                    <p className="text-gray-400">Sign in to access your courses anywhere</p>
                </div>

                <div className="space-y-4">
                    <button
                        onClick={handleGoogleSignIn}
                        disabled={isLoading}
                        className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 hover:bg-gray-100 font-medium py-3 px-4 rounded-xl transition-all duration-200 transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? (
                            <div className="w-5 h-5 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path
                                    fill="currentColor"
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                />
                            </svg>
                        )}
                        <span>Continue with Google</span>
                    </button>

                    {/* Divider */}
                    <div className="relative py-4">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-800"></div>
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-2 bg-[#1a1a1a] text-gray-500">or</span>
                        </div>
                    </div>

                    {/* Magic-link (email) sign-in */}
                    <form onSubmit={handleEmailSignIn} className="space-y-3">
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            className="w-full rounded-xl border border-gray-700 bg-[#1a1a1a] px-4 py-3 text-sm text-gray-200 placeholder:text-gray-500 focus:border-[#00ffd4]/50 focus:outline-none"
                            aria-label="Email"
                            autoComplete="email"
                        />
                        <button
                            type="submit"
                            disabled={emailLoading || !email.trim()}
                            className="w-full rounded-xl border border-[#00ffd4]/40 bg-[#00ffd4]/10 py-3 text-sm font-medium text-[#00ffd4] transition hover:bg-[#00ffd4]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {emailLoading ? 'Sending link…' : 'Continue with email'}
                        </button>
                        {magicSent && (
                            <p className="text-center text-xs text-emerald-300">
                                Check your inbox for a sign-in link.
                            </p>
                        )}
                    </form>
                </div>

                <div className="mt-8 text-center text-sm text-gray-500">
                    <p>By continuing, you agree to our Terms of Service and Privacy Policy.</p>
                </div>
            </div>
        </div>
    );
}
