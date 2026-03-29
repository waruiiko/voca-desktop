#!/bin/sh
unset ELECTRON_RUN_AS_NODE
export VITE_DEV_SERVER_URL=http://localhost:4173
export NODE_ENV=development
exec electron .
