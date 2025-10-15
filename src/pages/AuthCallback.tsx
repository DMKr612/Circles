import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      await supabase.auth.getSession(); // completes OAuth on web/PWA/native
      navigate('/', { replace: true });
    })();
  }, [navigate]);
  return null;
}