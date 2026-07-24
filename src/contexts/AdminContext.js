import React from 'react';

export const AdminContext = React.createContext(null);

export const useAdminContext = () => React.useContext(AdminContext);
