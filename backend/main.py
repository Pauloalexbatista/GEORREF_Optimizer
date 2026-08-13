from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sys
import os

# Ensure root import works
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.api import auth, projects, geocoding, fleet, solver, maps

app = FastAPI(
    title='GeoRoute Pro API',
    description='Backend API for professional vehicle routing and geocoding',
    version='1.0.0'
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],  # Adjust in production
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Include routers
app.include_router(auth.router, prefix='/api')
app.include_router(projects.router, prefix='/api')
app.include_router(geocoding.router, prefix='/api')
app.include_router(fleet.router, prefix='/api')
app.include_router(solver.router, prefix='/api')
app.include_router(maps.router)

@app.get('/')
def read_root():
    return {'message': 'Welcome to GeoRoute Pro API'}
