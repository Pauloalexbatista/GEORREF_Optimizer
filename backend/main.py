from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sys
import os

# Ensure root import works
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.api import auth, projects, geocoding, fleet, solver, maps, admin_users, tracking, reports
from database import init_database, ensure_entregas_columns

# Initialize database
try:
    init_database()
    ensure_entregas_columns()
except Exception as e:
    print(f"Error initializing database: {e}")

app = FastAPI(
    title='GeoRoutePlan API',
    description='Backend API for professional vehicle routing, geocoding and license management',
    version='2.0.0'
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
app.include_router(admin_users.router, prefix='/api')
app.include_router(projects.router, prefix='/api')
app.include_router(geocoding.router, prefix='/api')
app.include_router(fleet.router, prefix='/api')
app.include_router(solver.router, prefix='/api')
app.include_router(maps.router)
app.include_router(tracking.router, prefix='/api')
app.include_router(reports.router, prefix='/api')

@app.get('/')
def read_root():
    return {'message': 'Welcome to GeoRoutePlan API'}
