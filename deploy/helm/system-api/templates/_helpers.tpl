{{- define "system-api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "system-api.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "system-api.labels" -}}
helm.sh/chart: {{ include "system-api.chart" . }}
app.kubernetes.io/name: {{ include "system-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "system-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "system-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "system-api.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{- define "system-api.secretName" -}}
{{- if .Values.secret.nameOverride -}}
{{- .Values.secret.nameOverride -}}
{{- else -}}
{{- printf "%s-secrets" (include "system-api.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
