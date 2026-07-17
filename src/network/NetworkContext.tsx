import NetInfo from '@react-native-community/netinfo';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type NetworkContextValue = {
  isConnected: boolean;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        setIsConnected(
          state.isConnected !== false &&
            state.isInternetReachable !== false,
        );
      }),
    [],
  );

  const value = useMemo(() => ({ isConnected }), [isConnected]);

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within NetworkProvider');
  }
  return context;
}
