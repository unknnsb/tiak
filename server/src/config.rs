use std::env;

#[derive(Clone)]
pub struct Config {
    pub db_path: String,
    pub server_port: u16,
    pub allowed_origins: Vec<String>,
}

impl Config {
    pub fn from_env() -> Self {
        let db_path = env::var("DB_PATH").unwrap_or_else(|_| "data/jobs.sqlite".to_string());
        
        let server_port = env::var("SERVER_PORT")
            .unwrap_or_else(|_| "4697".to_string())
            .parse()
            .expect("SERVER_PORT must be a number");

        let allowed_origins_str = env::var("ALLOWED_ORIGINS").unwrap_or_else(|_| "".to_string());
        let allowed_origins = allowed_origins_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Config {
            db_path,
            server_port,
            allowed_origins,
        }
    }
}
