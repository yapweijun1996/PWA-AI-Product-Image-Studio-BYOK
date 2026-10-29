import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App';
import './styles.css';
import { UnsavedNavigationGuard } from './useUnsavedChanges';

const router = createBrowserRouter([
  { path: '*', element: <><UnsavedNavigationGuard /><App /></> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
