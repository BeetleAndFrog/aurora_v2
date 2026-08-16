'use client';

import { useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

export default function Home() {
  const { data: session } = useSession();
  const router = useRouter();

  // 🚀 BLANK CANVAS ON STARTUP - Universes load on demand from Memories
  useEffect(() => {
    console.log('🚀 [HOME] Starting with blank canvas - no auto-load');
  }, []);

  const handleExplore = () => {
    console.log('Navigating to /chat');
    router.push('/chat');
  };

  const handleCreateCourse = () => {
    console.log('Navigating to /course-builder');
    router.push('/course-builder');
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#050A1E] flex flex-col items-center justify-center">
      {/* Background Image */}
      <div
        className="absolute inset-0 z-0 opacity-40"
        style={{
          backgroundImage: 'url(/astryon-bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      {/* Auth Button */}
      <div className="absolute top-6 right-6 z-50">
        {session ? (
          <div className="flex items-center gap-4 bg-black/30 backdrop-blur-md p-2 pr-4 rounded-full border border-white/10 shadow-lg hover:bg-black/40 transition-all">
            {session.user?.image && (
              <Image
                src={session.user.image}
                alt="User"
                width={32}
                height={32}
                className="rounded-full border border-white/20"
              />
            )}
            <span className="text-white/90 text-sm font-medium hidden sm:block">
              {session.user?.name}
            </span>
            <button
              onClick={() => signOut()}
              className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-full transition-colors border border-white/5"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <button
            onClick={() => signIn()}
            className="bg-white/10 hover:bg-white/20 backdrop-blur-md text-white px-6 py-2.5 rounded-full font-medium border border-white/10 transition-all hover:scale-105 shadow-lg hover:shadow-cyan-500/20"
          >
            Sign In
          </button>
        )}
      </div>

      {/* Animated grid background */}
      <div className="absolute inset-0 z-0" style={{
        backgroundImage: `
          linear-gradient(rgba(0, 255, 212, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0, 255, 212, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        animation: 'gridMove 20s linear infinite',
      }} />

      {/* Dark overlay */}
      <div className="absolute inset-0 z-0 bg-radial-gradient from-transparent via-[#050A1E]/80 to-[#050A1E]" />

      {/* Floating orbs */}
      <div className="absolute top-[20%] left-[15%] w-[300px] h-[300px] rounded-full bg-blue-500/10 blur-[80px] animate-float" />
      <div className="absolute bottom-[20%] right-[15%] w-[400px] h-[400px] rounded-full bg-yellow-500/10 blur-[100px] animate-float-reverse" />

      {/* Central glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-cyan-500/5 rounded-full blur-[120px] animate-pulse-slow pointer-events-none z-0" />

      <style jsx>{`
        @keyframes pulse-slow {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.4; }
          50% { transform: translate(-50%, -50%) scale(1.15); opacity: 0.7; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-30px) rotate(2deg); }
        }
        @keyframes float-reverse {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(30px) rotate(-2deg); }
        }
        @keyframes gridMove {
          0% { transform: translate(0, 0); }
          100% { transform: translate(50px, 50px); }
        }
        @keyframes shimmer {
          0% { background-position: -1000px 0; }
          100% { background-position: 1000px 0; }
        }
        .animate-float { animation: float 8s ease-in-out infinite; }
        .animate-float-reverse { animation: float-reverse 10s ease-in-out infinite; }
        .animate-pulse-slow { animation: pulse-slow 4s ease-in-out infinite; }
        
        .hero-text-gradient {
          background-image: linear-gradient(90deg, #00ff87, #60efff, #b967ff, #ff61d8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        
        .subtitle-gradient {
          background-image: linear-gradient(90deg, #60efff, #5eb3ff, #ffd700, #ffb347);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .glass-card {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.05);
          box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
        }
        
        .glass-card:hover {
          background: rgba(255, 255, 255, 0.07);
          border-color: rgba(255, 255, 255, 0.1);
          transform: translateY(-5px);
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
        }
      `}</style>

      {/* Main Content */}
      <div className="relative z-10 text-center max-w-6xl px-4 flex flex-col items-center">
        {/* Logo/Title */}
        <h1 className="hero-text-gradient text-8xl md:text-9xl font-extrabold mb-6 tracking-tight drop-shadow-[0_0_80px_rgba(96,239,255,0.3)] animate-fade-in-up" style={{ fontFamily: 'var(--font-orbitron)' }}>
          Astryon
        </h1>

        {/* Tagline */}
        <h2 className="subtitle-gradient text-4xl md:text-5xl font-bold italic mb-16 max-w-3xl leading-tight drop-shadow-[0_0_30px_rgba(96,239,255,0.2)] animate-fade-in-up-delay-1">
          Learn Everything
        </h2>

        {/* CTA Buttons */}
        <div className="flex flex-wrap justify-center gap-8 mb-20 animate-fade-in-up-delay-2">
          {/* Explore Card */}
          <div
            onClick={handleExplore}
            className="glass-card group w-80 p-8 rounded-3xl cursor-pointer transition-all duration-300 border-t border-white/10"
          >
            <div className="text-5xl mb-6 group-hover:scale-110 transition-transform duration-300">💬</div>
            <h3 className="text-3xl font-bold text-blue-400 mb-4 group-hover:text-blue-300 transition-colors">Explore</h3>
            <p className="text-white/60 text-lg mb-8 leading-relaxed h-20">
              Engage in AI-powered conversations that expand into visual knowledge graphs
            </p>
            <button className="w-full py-4 px-6 text-lg font-bold text-white rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transition-all transform group-hover:-translate-y-1">
              Start Exploring
            </button>
          </div>

          {/* Create Course Card */}
          <div
            onClick={handleCreateCourse}
            className="glass-card group w-80 p-8 rounded-3xl cursor-pointer transition-all duration-300 border-t border-white/10"
          >
            <div className="text-5xl mb-6 group-hover:scale-110 transition-transform duration-300">🎓</div>
            <h3 className="text-3xl font-bold text-yellow-400 mb-4 group-hover:text-yellow-300 transition-colors">Create Course</h3>
            <p className="text-white/60 text-lg mb-8 leading-relaxed h-20">
              Build structured learning universes with AI-generated quizzes and essays
            </p>
            <button className="w-full py-4 px-6 text-lg font-bold text-[#050A1E] rounded-xl bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-300 hover:to-orange-300 shadow-lg shadow-yellow-500/20 hover:shadow-yellow-500/40 transition-all transform group-hover:-translate-y-1">
              Build Now
            </button>
          </div>
        </div>

        {/* Feature highlights */}
        <div className="flex flex-wrap justify-center gap-12 md:gap-20 opacity-70 hover:opacity-100 transition-opacity duration-500">
          <div className="text-center group">
            <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">🌌</div>
            <div className="text-white/90 font-semibold tracking-wide">3D Visualization</div>
          </div>
          <div className="text-center group">
            <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">🤖</div>
            <div className="text-white/90 font-semibold tracking-wide">AI-Powered</div>
          </div>
          <div className="text-center group">
            <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">🔗</div>
            <div className="text-white/90 font-semibold tracking-wide">Connected Learning</div>
          </div>
        </div>
      </div>
    </div>
  );
}
