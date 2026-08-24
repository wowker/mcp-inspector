SHELL := /bin/sh
.DEFAULT_GOAL := restart

NODE ?= node
NPM ?= npm
RUN_DIR := .run
PID_FILE := $(RUN_DIR)/dsers-inspector.pid
LOG_FILE := $(RUN_DIR)/dsers-inspector.log
APP_ENTRY := bin/dsers-inspector.mjs

.PHONY: restart build deps start stop status logs help

restart:
	@$(MAKE) --no-print-directory build
	@$(MAKE) --no-print-directory stop
	@$(MAKE) --no-print-directory start

build: deps
	$(NPM) run build

deps:
	@$(NODE) -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 22) { console.error("Node.js 22 or newer is required"); process.exit(1); }'
	@if [ ! -x node_modules/.bin/vite ] || [ ! -x node_modules/.bin/tsup ]; then \
		echo "Installing dependencies..."; \
		$(NPM) install; \
	fi

start:
	@if [ ! -f dist/server/main.js ]; then \
		echo "Build output is missing; compiling first..."; \
		$(MAKE) --no-print-directory build; \
	fi
	@mkdir -p "$(RUN_DIR)"
	@if [ -f "$(PID_FILE)" ]; then \
		pid=$$(cat "$(PID_FILE)"); \
		command=$$(ps -p "$$pid" -o command= 2>/dev/null || true); \
		case "$$command" in \
			*"$(APP_ENTRY)"*) echo "DSers MCP Inspector is already running (PID $$pid)."; exit 0 ;; \
		esac; \
		rm -f "$(PID_FILE)"; \
	fi
	@nohup $(NODE) "$(APP_ENTRY)" > "$(LOG_FILE)" 2>&1 & echo $$! > "$(PID_FILE)"
	@sleep 1
	@pid=$$(cat "$(PID_FILE)"); \
	if kill -0 "$$pid" 2>/dev/null; then \
		echo "DSers MCP Inspector started (PID $$pid)."; \
		echo "The browser will open automatically. Logs: $(LOG_FILE)"; \
	else \
		echo "DSers MCP Inspector failed to start. Recent logs:"; \
		tail -n 30 "$(LOG_FILE)" 2>/dev/null || true; \
		rm -f "$(PID_FILE)"; \
		exit 1; \
	fi

stop:
	@if [ ! -f "$(PID_FILE)" ]; then \
		echo "DSers MCP Inspector is not running."; \
		exit 0; \
	fi; \
	pid=$$(cat "$(PID_FILE)"); \
	command=$$(ps -p "$$pid" -o command= 2>/dev/null || true); \
	case "$$command" in \
		*"$(APP_ENTRY)"*) ;; \
		*) echo "Removing stale PID file; no Inspector process was stopped."; rm -f "$(PID_FILE)"; exit 0 ;; \
	esac; \
	kill "$$pid"; \
	attempt=0; \
	while kill -0 "$$pid" 2>/dev/null && [ "$$attempt" -lt 10 ]; do \
		sleep 0.5; \
		attempt=$$((attempt + 1)); \
	done; \
	if kill -0 "$$pid" 2>/dev/null; then \
		echo "Inspector did not stop cleanly (PID $$pid)."; \
		exit 1; \
	fi; \
	rm -f "$(PID_FILE)"; \
	echo "DSers MCP Inspector stopped."

status:
	@if [ -f "$(PID_FILE)" ]; then \
		pid=$$(cat "$(PID_FILE)"); \
		command=$$(ps -p "$$pid" -o command= 2>/dev/null || true); \
		case "$$command" in \
			*"$(APP_ENTRY)"*) echo "DSers MCP Inspector is running (PID $$pid)."; exit 0 ;; \
		esac; \
	fi; \
	echo "DSers MCP Inspector is not running."; \
	exit 1

logs:
	@mkdir -p "$(RUN_DIR)"
	@touch "$(LOG_FILE)"
	tail -f "$(LOG_FILE)"

help:
	@echo "make / make restart  Install missing dependencies, rebuild, and restart"
	@echo "make start           Start the existing build in the background"
	@echo "make stop            Gracefully stop this project's Inspector process"
	@echo "make status          Show whether the Inspector is running"
	@echo "make logs            Follow the Inspector log (Ctrl-C to exit)"
	@echo "make build           Install missing dependencies and rebuild"
