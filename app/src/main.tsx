import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router-dom';
import { App } from './App';
import './ui/tokens.css';
import './ui/components.css';
import './ui/layout.css';
import { UnsavedNavigationGuard } from './useUnsavedChanges';

// Pages cannot provide an SPA navigation fallback.
const createRouter = import.meta.env.MODE === 'pages' ? createHashRouter : createBrowserRouter;
const router = createRouter([
  { path: '*', element: <><UnsavedNavigationGuard /><App /></> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
