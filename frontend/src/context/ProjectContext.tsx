"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/utils/api";
import { useAuth } from "./AuthContext";

interface Project {
  id: number;
  nome: string;
  descricao: string;
  created_at: string;
}

interface ProjectContextType {
  projects: Project[];
  selectedProject: Project | null;
  loading: boolean;
  selectProject: (id: number) => void;
  refreshProjects: () => Promise<void>;
  createProject: (nome: string, descricao?: string) => Promise<Project>;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshProjects = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await apiRequest("/api/projects/");
      setProjects(data);
      
      const cachedId = localStorage.getItem("georoute_selected_project_id");
      if (cachedId) {
        const found = data.find((p: Project) => p.id === parseInt(cachedId));
        if (found) {
          setSelectedProject(found);
        } else if (data.length > 0) {
          setSelectedProject(data[0]);
          localStorage.setItem("georoute_selected_project_id", data[0].id.toString());
        }
      } else if (data.length > 0) {
        setSelectedProject(data[0]);
        localStorage.setItem("georoute_selected_project_id", data[0].id.toString());
      }
    } catch (e) {
      console.error("Failed to fetch projects:", e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      refreshProjects();
    } else {
      setProjects([]);
      setSelectedProject(null);
    }
  }, [user, refreshProjects]);

  const selectProject = (id: number) => {
    const found = projects.find((p) => p.id === id);
    if (found) {
      setSelectedProject(found);
      localStorage.setItem("georoute_selected_project_id", id.toString());
    }
  };

  const createProject = async (nome: string, descricao: string = "") => {
    try {
      const newProj = await apiRequest("/api/projects/", {
        method: "POST",
        body: JSON.stringify({ nome, descricao }),
      });
      setProjects((prev) => [...prev, newProj]);
      setSelectedProject(newProj);
      localStorage.setItem("georoute_selected_project_id", newProj.id.toString());
      return newProj;
    } catch (error) {
      throw error;
    }
  };

  return (
    <ProjectContext.Provider
      value={{
        projects,
        selectedProject,
        loading,
        selectProject,
        refreshProjects,
        createProject,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("useProjects must be used within a ProjectProvider");
  }
  return context;
}
